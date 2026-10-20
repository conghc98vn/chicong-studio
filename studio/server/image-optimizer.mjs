import sharp from 'sharp';
import {stat} from 'node:fs/promises';
import {maxUploadBytes, uploadSizeLabel} from '../web/upload-policy.mjs';

export const imagePolicy = Object.freeze({maxBytes: maxUploadBytes, maxPixels: 40000000, edge: 2400, quality: 88, thumbEdge: 900, thumbQuality: 80, downloadEdge: 2400, downloadQuality: 92});
const invalid = (code, message) => Object.assign(new Error(message), {code, retryable: false});

export async function encodeDownloadJpeg(input, {onDemand = false, policy = imagePolicy} = {}) {
  return sharp(input, {limitInputPixels: policy.maxPixels, animated: false, failOn: 'warning'}).rotate()
    .resize({width: imagePolicy.downloadEdge, height: imagePolicy.downloadEdge, fit: 'inside', withoutEnlargement: true})
    .flatten({background: '#ffffff'}).withIccProfile('srgb')
    .jpeg({quality: imagePolicy.downloadQuality, mozjpeg: !onDemand, chromaSubsampling: '4:4:4'}).toBuffer();
}

async function optimizeInput(source, sourceBytes, {runStage = (_name, fn) => fn(), policy = imagePolicy, drive = false} = {}) {
  if (!sourceBytes) throw invalid('EMPTY_FILE', 'Tệp rỗng. Hãy xuất lại ảnh từ Lightroom.');
  if (sourceBytes > policy.maxBytes) throw invalid('FILE_TOO_LARGE', drive ? 'Ảnh vượt giới hạn dung lượng nguồn Drive đã cấu hình.' : `Ảnh vượt quá ${uploadSizeLabel}. Hãy xuất JPEG sRGB, cạnh dài 2400–4096 px rồi tải lại.`);
  const input = sharp(source, {limitInputPixels: policy.maxPixels, animated: false, failOn: 'warning'});
  let meta;
  try {
    meta = await runStage('decode', () => input.metadata());
  } catch (error) {
    if (/pixel limit/i.test(error.message)) throw invalid('PIXEL_LIMIT', drive ? 'Ảnh vượt giới hạn megapixel nguồn Drive đã cấu hình.' : 'Ảnh vượt quá 40 megapixel. Hãy xuất cạnh dài tối đa 6000 px rồi tải lại.');
    throw invalid('INVALID_IMAGE', 'Không đọc được ảnh hoặc tệp bị hỏng. Hãy xuất lại JPEG, PNG hoặc WebP.');
  }
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw invalid('UNSUPPORTED_FORMAT', 'Chỉ hỗ trợ JPEG, PNG và WebP. Hãy xuất ảnh JPEG từ Lightroom.');
  if ((meta.pages || 1) > 1) throw invalid('ANIMATED_IMAGE', 'Chưa hỗ trợ ảnh động. Hãy chọn ảnh tĩnh JPEG, PNG hoặc WebP.');
  // Large source policy is deliberately JPEG-only. Other supported formats keep
  // the existing upload limits, independently of the filename or declared MIME.
  if (drive && meta.format !== 'jpeg') {
    if (sourceBytes > imagePolicy.maxBytes) throw invalid('FILE_TOO_LARGE', 'PNG/WebP Drive vượt giới hạn 20 MiB.');
    if (meta.width * meta.height > imagePolicy.maxPixels) throw invalid('PIXEL_LIMIT', 'PNG/WebP Drive vượt giới hạn 40 megapixel.');
  }
  const render = (edge, quality) => input.clone().rotate()
    .resize({width: edge, height: edge, fit: 'inside', withoutEnlargement: true})
    .toColourspace('srgb').webp({quality, effort: 6, smartSubsample: true}).toBuffer({resolveWithObject: true});
  try {
    const full = await runStage('webp', () => render(imagePolicy.edge, imagePolicy.quality));
    const thumb = await runStage('thumbnail', () => render(imagePolicy.thumbEdge, imagePolicy.thumbQuality));
    const download = await runStage('jpeg', () => encodeDownloadJpeg(source, {policy}));
    const optimization = {source_bytes: sourceBytes, image_bytes: full.data.length, thumb_bytes: thumb.data.length, download_bytes: download.length, width: full.info.width, height: full.info.height};
    return {data: full.data, thumbnail: thumb.data, download, optimization};
  } catch (error) {
    if (error.code && error.retryable === false) throw error;
    throw invalid('INVALID_IMAGE', 'Ảnh bị lỗi khi giải mã. Hãy xuất lại ảnh từ Lightroom; không chỉ đổi đuôi tệp.');
  }
}

export async function optimizePhoto(buffer, options = {}) {
  return optimizeInput(buffer, buffer.length, {...options, policy: imagePolicy});
}

// Called only in the isolated encoder process. The parent never buffers originals.
export async function optimizeDrivePhotoPath(inputPath, policy) {
  const source = await stat(inputPath);
  if (!source.isFile()) throw invalid('INVALID_IMAGE', 'Nguồn ảnh phải là file thường.');
  return optimizeInput(inputPath, source.size, {policy, drive: true});
}

export function photoOptimization(photo) {
  if (photo.source_bytes == null || photo.image_bytes == null || photo.thumb_bytes == null) return null;
  return {source_bytes: Number(photo.source_bytes), image_bytes: Number(photo.image_bytes), thumb_bytes: Number(photo.thumb_bytes), download_bytes: photo.download_bytes == null ? null : Number(photo.download_bytes), width: photo.width, height: photo.height};
}
