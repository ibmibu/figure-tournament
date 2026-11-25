// Versioned static portraits can be cached without adding Supabase or image-optimizer traffic.
module.exports = {
  async headers() {
    return [{
      source: '/fighters/square-v1/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    }];
  },
};
