// Requires the `x-app-secret` header to match process.env.APP_SECRET.
// Mounted on all /api routes except /api/health (see server.js for the
// router ordering that exempts it).
export function requireAppSecret(req, res, next) {
  const provided = req.header('x-app-secret');
  if (!provided || provided !== process.env.APP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
