import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_KEY, RateLimitOptions } from './rate-limit.decorator';
import { RateLimitStore } from './rate-limit.store';

/**
 * Sliding-window rate limiter. Routes opt in with @RateLimit(limit, windowSec).
 * Keyed by route + IP, plus the authenticated user when present, plus an
 * optional body field (account identity) or route param (resource identity).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: RateLimitStore,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const opts = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!opts) return true;

    const req = ctx.switchToHttp().getRequest();
    const parts = [`${req.method}:${req.baseUrl || ''}${req.path || req.url}`, `ip:${req.ip || 'unknown'}`];
    if (req.user?.sub) parts.push(`user:${req.user.sub}`);
    if (opts.byBodyField && req.body?.[opts.byBodyField]) {
      parts.push(`body:${String(req.body[opts.byBodyField]).toLowerCase()}`);
    }
    if (opts.byParam && req.params?.[opts.byParam]) {
      parts.push(`param:${req.params[opts.byParam]}`);
    }

    const retryAfter = this.store.hit(parts.join('|'), opts.limit, opts.windowSec);
    if (retryAfter !== null) {
      const res = ctx.switchToHttp().getResponse();
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many requests. Please slow down and try again shortly.', retryAfterSec: retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
