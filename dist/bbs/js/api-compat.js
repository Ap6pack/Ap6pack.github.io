'use strict';

(() => {
  const BBS_API = 'https://rdvtghfbytigdxtjopbz.supabase.co/functions/v1/bbs';
  const BROWSER_PROXY = 'https://rdvtghfbytigdxtjopbz.supabase.co/functions/v1/bbs-browser';
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const requestUrl = typeof input === 'string' ? input : input?.url;
    if (requestUrl !== BBS_API) return nativeFetch(input, init);

    let payload = {};
    try {
      payload = init.body ? JSON.parse(String(init.body)) : {};
    } catch {
      return nativeFetch(input, init);
    }

    const headers = new Headers(init.headers || undefined);
    const authorization = headers.get('Authorization');
    if (authorization?.startsWith('Bearer ')) {
      payload.sessionToken = authorization.slice(7).trim();
    }

    headers.delete('Authorization');
    headers.delete('Content-Type');

    return nativeFetch(BROWSER_PROXY, {
      ...init,
      headers,
      body: JSON.stringify(payload),
    });
  };
})();
