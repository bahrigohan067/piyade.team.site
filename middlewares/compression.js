const zlib = require('zlib');

const COMPRESSIBLE_MIME_REGEX =
  /^(text\/|application\/(javascript|x-javascript|json|xml|manifest\+json|ld\+json)|image\/svg\+xml)/i;

/**
 * Node.js 20 yerleşik zlib modülünü kullanan Gzip / Brotli HTTP sıkıştırma katmanı.
 * Harici bağımlılık gerektirmez; hem res.send (HTML, JSON, XML) hem de express.static
 * akışlarını (CSS, JS) sıkıştırır.
 */
function compressionMiddleware(req, res, next) {
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  if (!acceptEncoding || req.method === 'HEAD') {
    return next();
  }

  const supportsBr = /\bbr\b/.test(acceptEncoding);
  const supportsGzip = /\bgzip\b/.test(acceptEncoding);

  if (!supportsBr && !supportsGzip) {
    return next();
  }

  const chunks = [];
  let passthroughMode = false;
  let compressionDecided = false;

  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  const origWriteHead = res.writeHead.bind(res);

  function shouldCompressResponse() {
    if (res.getHeader('Content-Encoding')) return false;
    const status = res.statusCode || 200;
    if (status === 204 || status === 304 || (status >= 100 && status < 200)) return false;
    const contentType = String(res.getHeader('Content-Type') || '');
    return COMPRESSIBLE_MIME_REGEX.test(contentType);
  }

  // writeHead doğrudan çağrıldığında sıkıştırılabilir bir yanıt ise Content-Length henüz yazılmasın
  res.writeHead = function patchedWriteHead(statusCode, statusMessage, headers) {
    if (!compressionDecided && !passthroughMode) {
      res.statusCode = statusCode;
      if (typeof statusMessage === 'object' && statusMessage !== null) {
        for (const [k, v] of Object.entries(statusMessage)) {
          res.setHeader(k, v);
        }
      } else if (headers && typeof headers === 'object') {
        for (const [k, v] of Object.entries(headers)) {
          res.setHeader(k, v);
        }
      }
      if (shouldCompressResponse()) {
        return res;
      }
      passthroughMode = true;
    }
    return origWriteHead(statusCode, statusMessage, headers);
  };

  res.write = function patchedWrite(chunk, encoding, cb) {
    if (passthroughMode) {
      return origWrite(chunk, encoding, cb);
    }

    if (!compressionDecided) {
      if (!shouldCompressResponse()) {
        passthroughMode = true;
        return origWrite(chunk, encoding, cb);
      }
    }

    if (chunk !== undefined && chunk !== null) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding || 'utf8');
      chunks.push(buf);
    }
    if (typeof encoding === 'function') encoding();
    else if (typeof cb === 'function') cb();
    return true;
  };

  res.end = function patchedEnd(chunk, encoding, cb) {
    if (typeof chunk === 'function') {
      cb = chunk;
      chunk = null;
      encoding = null;
    } else if (typeof encoding === 'function') {
      cb = encoding;
      encoding = null;
    }

    if (passthroughMode) {
      return origEnd(chunk, encoding, cb);
    }

    if (chunk !== undefined && chunk !== null) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding || 'utf8');
      chunks.push(buf);
    }

    compressionDecided = true;
    const rawBuffer = chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);

    if (!shouldCompressResponse() || rawBuffer.length < 256) {
      passthroughMode = true;
      if (rawBuffer.length > 0) {
        return origEnd(rawBuffer, cb);
      }
      return origEnd(cb);
    }

    try {
      res.setHeader('Vary', 'Accept-Encoding');
      res.removeHeader('Content-Length');

      if (supportsBr) {
        const compressed = zlib.brotliCompressSync(rawBuffer, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
          },
        });
        res.setHeader('Content-Encoding', 'br');
        res.setHeader('Content-Length', String(compressed.length));
        return origEnd(compressed, cb);
      }

      if (supportsGzip) {
        const compressed = zlib.gzipSync(rawBuffer, { level: 6 });
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Length', String(compressed.length));
        return origEnd(compressed, cb);
      }
    } catch (_) {
      // Sıkıştırma hatasında ham yanıtı dön
    }

    return origEnd(rawBuffer, cb);
  };

  return next();
}

module.exports = {
  compressionMiddleware,
};
