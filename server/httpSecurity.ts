import type { NextFunction, Request, Response } from 'express';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isTrustedBrowserOrigin(origin: string | undefined) {
  // CLI, MCP, curl và proxy server-to-server không gửi Origin.
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function localOriginGuard(req: Request, res: Response, next: NextFunction) {
  if (isTrustedBrowserOrigin(req.get('origin'))) {
    next();
    return;
  }
  res.status(403).json({ code: 'untrustedOrigin', error: 'Huccanta chỉ nhận yêu cầu trình duyệt từ máy local.' });
}

export function localSecurityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'"
  ].join('; '));
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
}
