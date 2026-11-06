const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const DATA_FILE = path.join(__dirname, 'data', 'orders.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'oficina2024';
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// Auth middleware for admin routes
function adminAuth(req, res, next) {
  const { password } = req.headers;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  next();
}

// GET all data
app.get('/api/orders', (req, res) => {
  res.json(readData());
});

// UPDATE a single order
app.put('/api/orders/:id', adminAuth, (req, res) => {
  const data = readData();
  const idx = data.orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'OS não encontrada' });

  const updated = { ...data.orders[idx], ...req.body };
  data.orders[idx] = updated;

  // Recalculate stats
  data.stats.inProgress = data.orders.filter(o => o.status === 'em_andamento').length;
  data.stats.waitingParts = data.orders.filter(o => o.status === 'aguardando_peca').length;
  data.stats.completed = data.orders.filter(o => o.status === 'concluido').length;
  data.stats.diagnostic = data.orders.filter(o => o.status === 'diagnostico').length;
  data.stats.totalRevenue = data.orders.reduce((sum, o) => sum + (o.value || 0), 0);
  data.stats.totalOrders = data.orders.length;

  writeData(data);
  broadcast({ type: 'update', data });
  res.json({ success: true, order: updated });
});

// ADD new order
app.post('/api/orders', adminAuth, (req, res) => {
  const data = readData();
  const newOrder = {
    id: `OS${String(Date.now()).slice(-6)}`,
    ...req.body,
    arrival: new Date().toISOString()
  };
  data.orders.push(newOrder);
  data.emptySlots = data.emptySlots.filter(s => s !== newOrder.slot);
  writeData(data);
  broadcast({ type: 'update', data });
  res.json({ success: true, order: newOrder });
});

// DELETE (finish/remove) an order
app.delete('/api/orders/:id', adminAuth, (req, res) => {
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'OS não encontrada' });

  data.orders = data.orders.filter(o => o.id !== req.params.id);
  if (order.slot && !data.emptySlots.includes(order.slot)) {
    data.emptySlots.push(order.slot);
    data.emptySlots.sort((a, b) => a - b);
  }
  writeData(data);
  broadcast({ type: 'update', data });
  res.json({ success: true });
});

// Auth check
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Senha incorreta' });
  }
});

// WebSocket connection
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'connected', data: readData() }));
});

server.listen(PORT, () => {
  console.log(`\n🚗 Dashboard 3D - Oficina Mecânica`);
  console.log(`📺 Painel 3D:   http://localhost:${PORT}`);
  console.log(`📱 Equipe:      http://localhost:${PORT}/admin.html`);
  console.log(`🔑 Senha admin: ${ADMIN_PASSWORD}\n`);
});
