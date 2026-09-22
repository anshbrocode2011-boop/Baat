import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';

const app = express();
const server = http.createServer(app);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-secret';
const PORT = Number(process.env.PORT || 3000);
const clients = new Map<string, Set<WebSocket>>();

type AuthRequest = Request & { user?: { id: string; chatId: string } };
const auth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  try { if (!token) throw new Error(); req.user = jwt.verify(token, JWT_SECRET) as { id: string; chatId: string }; next(); }
  catch { res.status(401).json({ error: 'Authentication required' }); }
};
const sendTo = (userId: string, event: unknown) => clients.get(userId)?.forEach(ws => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(event)));
const chatId = async () => { for (;;) { const id = `BAAT-${crypto.randomInt(10000, 99999)}`; const r = await pool.query('SELECT 1 FROM users WHERE chat_id=$1', [id]); if (!r.rowCount) return id; } };
const safeUser = (row: any) => ({ id: row.id, chatId: row.chat_id, username: row.username, displayName: row.display_name || row.username, bio: row.bio || '', status: row.status || 'Available', avatarUrl: row.avatar_url, accent: row.accent || '#9bf6ff', online: clients.has(row.id) });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json({ limit: '64kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true }));

app.post('/api/auth/register', async (req, res) => {
  const parsed = z.object({ username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/), password: z.string().min(8).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Username or password is invalid' });
  try {
    const id = await chatId(); const hash = await argon2.hash(parsed.data.password);
    const result = await pool.query('INSERT INTO users(chat_id,username,password_hash) VALUES($1,$2,$3) RETURNING id,chat_id,username', [id, parsed.data.username, hash]);
    await pool.query('INSERT INTO profiles(user_id,display_name) VALUES($1,$2)', [result.rows[0].id, parsed.data.username]);
    const token = jwt.sign({ id: result.rows[0].id, chatId: id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { ...result.rows[0], chatId: id, displayName: parsed.data.username } });
  } catch (e: any) { res.status(e.code === '23505' ? 409 : 500).json({ error: e.code === '23505' ? 'Username already taken' : 'Could not create account' }); }
});
app.post('/api/auth/login', async (req, res) => {
  const parsed = z.object({ chatId: z.string().toUpperCase(), password: z.string() }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Invalid credentials' });
  const r = await pool.query('SELECT u.*,p.* FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.chat_id=$1', [parsed.data.chatId]);
  if (!r.rowCount || !(await argon2.verify(r.rows[0].password_hash, parsed.data.password))) return res.status(401).json({ error: 'Invalid Chat ID or password' });
  const u = r.rows[0]; res.json({ token: jwt.sign({ id: u.id, chatId: u.chat_id }, JWT_SECRET, { expiresIn: '30d' }), user: safeUser(u) });
});
app.post('/api/auth/logout', auth, async (req: AuthRequest, res) => { res.json({ ok: true }); });
app.post('/api/auth/logout-all', auth, async (req: AuthRequest, res) => { res.json({ ok: true }); });

app.get('/api/users/search', auth, async (req: AuthRequest, res) => { const q = String(req.query.q || '').toUpperCase().slice(0, 32); const r = await pool.query('SELECT u.*,p.* FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.chat_id ILIKE $1 OR u.username ILIKE $1 LIMIT 12', [`%${q}%`]); res.json(r.rows.filter(x => x.id !== req.user!.id).map(safeUser)); });
app.get('/api/users/:chatId', auth, async (req, res) => { const r = await pool.query('SELECT u.*,p.* FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.chat_id=$1', [req.params.chatId.toUpperCase()]); if (!r.rowCount) return res.status(404).json({ error: 'User not found' }); res.json(safeUser(r.rows[0])); });
app.patch('/api/profile', auth, async (req: AuthRequest, res) => { const p = z.object({ displayName: z.string().min(1).max(64), bio: z.string().max(160), status: z.string().max(80), accent: z.string().regex(/^#[0-9a-f]{6}$/i) }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Invalid profile' }); const r = await pool.query('UPDATE profiles SET display_name=$1,bio=$2,status=$3,accent=$4 WHERE user_id=$5 RETURNING *', [p.data.displayName,p.data.bio,p.data.status,p.data.accent,req.user!.id]); res.json(r.rows[0]); });

app.get('/api/chats', auth, async (req: AuthRequest, res) => { const r = await pool.query(`SELECT c.id,c.updated_at, u.chat_id,u.username,p.display_name,p.avatar_url,p.accent FROM chats c JOIN chat_members me ON me.chat_id=c.id JOIN chat_members other ON other.chat_id=c.id AND other.user_id<>me.user_id JOIN users u ON u.id=other.user_id LEFT JOIN profiles p ON p.user_id=u.id WHERE me.user_id=$1 ORDER BY c.updated_at DESC`, [req.user!.id]); res.json(r.rows.map(x => ({ id:x.id, updatedAt:x.updated_at, user:{ chatId:x.chat_id, username:x.username, displayName:x.display_name, avatarUrl:x.avatar_url, accent:x.accent, online:clients.has(x.user_id) } }))); });
app.post('/api/chats', auth, async (req: AuthRequest, res) => { const target = await pool.query('SELECT id FROM users WHERE chat_id=$1',[String(req.body.chatId||'').toUpperCase()]); if (!target.rowCount || target.rows[0].id===req.user!.id) return res.status(400).json({error:'Choose another valid Chat ID'}); const existing=await pool.query('SELECT c.id FROM chats c JOIN chat_members a ON a.chat_id=c.id JOIN chat_members b ON b.chat_id=c.id WHERE a.user_id=$1 AND b.user_id=$2',[req.user!.id,target.rows[0].id]); if(existing.rowCount) return res.json({id:existing.rows[0].id}); const c=await pool.query('INSERT INTO chats DEFAULT VALUES RETURNING id',[ ]); await pool.query('INSERT INTO chat_members(chat_id,user_id) VALUES($1,$2),($1,$3)',[c.rows[0].id,req.user!.id,target.rows[0].id]); res.status(201).json({id:c.rows[0].id}); });
app.get('/api/chats/:id/messages', auth, async (req: AuthRequest, res) => { const member=await pool.query('SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2',[req.params.id,req.user!.id]); if(!member.rowCount) return res.status(403).json({error:'Forbidden'}); const r=await pool.query('SELECT id,chat_id,sender_id,body,edited_at,deleted_at,created_at,read_at FROM messages WHERE chat_id=$1 ORDER BY created_at ASC LIMIT 200',[req.params.id]); res.json(r.rows); });

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const token = new URL(req.url || '', 'http://localhost').searchParams.get('token'); let identity: any;
  try { identity = jwt.verify(token || '', JWT_SECRET); } catch { ws.close(1008, 'Unauthorized'); return; }
  const set = clients.get(identity.id) || new Set<WebSocket>(); set.add(ws); clients.set(identity.id, set); sendTo(identity.id, { type:'presence.update', online:true });
  ws.on('message', async raw => { try { const event=JSON.parse(raw.toString()); if(event.type==='typing.start'||event.type==='typing.stop') { const members=await pool.query('SELECT user_id FROM chat_members WHERE chat_id=$1 AND user_id<>$2',[event.chatId,identity.id]); members.rows.forEach(x=>sendTo(x.user_id,{...event,userId:identity.id})); return; } if(event.type==='message.send') { const body=z.string().trim().min(1).max(4000).parse(event.body); const member=await pool.query('SELECT user_id FROM chat_members WHERE chat_id=$1',[event.chatId]); if(!member.rows.some(x=>x.user_id===identity.id)) return; const m=await pool.query('INSERT INTO messages(chat_id,sender_id,body) VALUES($1,$2,$3) RETURNING id,chat_id,sender_id,body,created_at,read_at',[event.chatId,identity.id,body]); await pool.query('UPDATE chats SET updated_at=now() WHERE id=$1',[event.chatId]); member.rows.forEach(x=>sendTo(x.user_id,{type:'message.new',message:m.rows[0]})); } } catch { ws.send(JSON.stringify({type:'error',error:'Invalid event'})); } });
  ws.on('close',()=>{ set.delete(ws); if(!set.size){clients.delete(identity.id); sendTo(identity.id,{type:'presence.update',online:false});} });
});

const __dirname=path.dirname(fileURLToPath(import.meta.url)); app.use(express.static(path.join(__dirname,'../public'))); app.get('*',(_,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));
server.listen(PORT,()=>console.log(`Baat listening on http://localhost:${PORT}`));
