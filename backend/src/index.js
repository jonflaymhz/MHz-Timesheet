require('dotenv').config();
require('express-async-errors');
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');

const authRoutes = require('./routes/auth');
const weeksRoutes = require('./routes/weeks');
const referenceRoutes = require('./routes/reference');
const adminRoutes = require('./routes/admin');
const teamRoutes = require('./routes/team');
const { runHourlySync } = require('./services/qwPull');

const app = express();

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? 'https://timesheet.mhz.limited' : true,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/weeks', weeksRoutes);
app.use('/api/reference', referenceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/team', teamRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '../frontend-dist');
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

const PORT = process.env.PORT || 3003;

// Plain HTTP, loopback-only — nginx terminates TLS in front (cert still
// needs the certbot --manual DNS-01 renewal before 2026-11-26).
http.createServer(app).listen(PORT, '127.0.0.1', () => {
  console.log(`Megahertz Timesheet API running on 127.0.0.1:${PORT} [${process.env.NODE_ENV}, behind nginx]`);
});

// Hourly pull (Section 2, decided) — projects and cost-code rates from QW.
cron.schedule('0 * * * *', () => {
  runHourlySync().catch(err => console.error('Hourly QW sync failed:', err.message));
});
// Run once at startup too, so a freshly deployed instance isn't empty for
// up to an hour.
runHourlySync().catch(err => console.error('Startup QW sync failed:', err.message));
