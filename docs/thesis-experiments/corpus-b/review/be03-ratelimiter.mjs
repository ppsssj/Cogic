// Review of the annotate-assist draft for be03-ratelimiter (src/common/middleware/rateLimiter.ts).
export function apply(gt, h) {
  // No relation: rateLimit is untyped third-party; keyGenerator's body only reads req.ip (no call, no node reference).
  // The Request type is imported from "express" (no declaration in the corpus).
  void gt;
  void h;
}
