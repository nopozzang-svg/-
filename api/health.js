/* global process */

export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    service: "sail-dashboard-api",
    now: new Date().toISOString(),
    vercelUrl: process.env.VERCEL_URL || null,
  });
}
