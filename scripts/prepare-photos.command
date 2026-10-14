#!/bin/bash
# Double-click in Finder, then drag source folder(s) into the Terminal window.
set -u
chicong_script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)" || exit 1
chicong_project_dir="$(cd "$chicong_script_dir/.." && pwd)" || exit 1
cd "$chicong_project_dir" || exit 1

chicong_node=''
chicong_path_node="$(command -v node || true)"
for chicong_candidate in "$chicong_path_node" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -n "$chicong_candidate" ] && [ -x "$chicong_candidate" ] && "$chicong_candidate" -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=13)?0:1)' 2>/dev/null; then
    chicong_node="$chicong_candidate"
    break
  fi
done

chicong_status=0
if [ -z "$chicong_node" ]; then
  echo 'Cần Node.js phiên bản 22.13 trở lên. Cài Node.js LTS rồi mở lại công cụ.'
  chicong_status=1
elif ! "$chicong_node" --input-type=module -e 'import sharp from "sharp"; sharp.versions;' >/dev/null 2>&1; then
  echo 'Thiếu thư viện xử lý ảnh. Mở Terminal tại thư mục dự án và chạy npm ci, sau đó mở lại công cụ.'
  echo "Thư mục dự án: $chicong_project_dir"
  chicong_status=1
else
  "$chicong_node" studio/tools/prepare-photos.mjs --interactive
  chicong_status=$?
fi

echo
read -r -p 'Nhấn Enter để đóng cửa sổ này… ' chicong_close
exit "$chicong_status"
