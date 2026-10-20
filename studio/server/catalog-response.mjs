import {gzip} from 'node:zlib';
import {promisify} from 'node:util';

const compress = promisify(gzip);

// Catalogs stay complete for cross-page selection and lightbox navigation.
// Compress only these read responses; uploads, streams and auth are untouched.
export async function sendCatalog(req, res, value) {
  res.vary('Accept-Encoding');
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) < 1024 || !req.get('Accept-Encoding') ||
      req.acceptsEncodings('gzip', 'identity') !== 'gzip' ||
      /\bno-transform\b/i.test(res.get('Cache-Control') || '')) {
    return res.type('json').send(json);
  }
  const body = await compress(json);
  return res.type('json').set('Content-Encoding', 'gzip').send(body);
}
