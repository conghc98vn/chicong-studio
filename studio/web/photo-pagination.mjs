export const albumPageSize = 90;
export const adminPageSize = 120;
export const largeGalleryThreshold = 360;
export const largeAdminThreshold = 240;

export function pageWindow(items, page, size) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const index = Math.max(0, Math.min(pages - 1, Number.isInteger(page) ? page : 0));
  const start = index * size;
  return {items: items.slice(start, start + size), page: index, pages, start, total: items.length};
}

export function photoPager(window, action) {
  if (window.pages <= 1) return '';
  return `<nav class="photo-pagination" aria-label="Trang ảnh">
    <button class="small-btn" data-action="${action}" data-page="${window.page - 1}" ${window.page === 0 ? 'disabled' : ''}>Trang trước</button>
    <span role="status">Ảnh ${window.start + 1}–${window.start + window.items.length} / ${window.total} · Trang ${window.page + 1}/${window.pages}</span>
    <button class="small-btn" data-action="${action}" data-page="${window.page + 1}" ${window.page + 1 >= window.pages ? 'disabled' : ''}>Trang sau</button>
  </nav>`;
}
