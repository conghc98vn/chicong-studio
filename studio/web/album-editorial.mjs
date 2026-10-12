// Verified copy for the imported portfolio; custom descriptions take precedence.
const stories = {
  "f5364d170eb33dd7663dd3a83728e192": {
    "slug": "wedding-on-film",
    "original": "Những cuộn film cưới đầu tiên: từ buổi chuẩn bị, lễ cưới trong mưa đến những khoảnh khắc dưới ánh đèn đêm. Ảnh: Chí Công. Cảm ơn Đạt Phạm đã đặt nền móng cho những cuộn film cưới đầu tiên.",
    "summary": "Film · Sắc màu của một ngày mưa",
    "intro": ""
  },
  "c64c0ff5b22f7ca2af5c6b6918e0cfee": {
    "slug": "ceremony-t-t",
    "original": "Ceremony | T & T. Photographed for Helios Bridal.",
    "summary": "Lễ đính hôn · Một nụ hôn trên trán",
    "intro": "Tà áo dài trắng, một nụ hôn trên trán và nụ cười trong lễ đính hôn của T & T. Những cử chỉ nhỏ cũng là điều đáng nhớ trong ngày vui."
  },
  "91d8e5f65a0ea8c06a876b6702195f26": {
    "slug": "a-new-chapter-of-love",
    "original": "Cheers to a new chapter of love! Photography by Chí Công and Trịnh Công Sơn for Le Hoa Bridal.",
    "summary": "Buổi lễ · Ánh nhìn dành cho nhau",
    "intro": "Ánh nhìn và những lời chia sẻ của hai người trong buổi lễ. Một khởi đầu mới được kể bằng những khoảnh khắc bên nhau."
  },
  "fe7dac533ee8f0f6be2f276e2fcae9bd": {
    "slug": "love-in-the-details",
    "original": "Love in the details, beauty in every frame. Photographed for Helios Bridal.",
    "summary": "Lễ gia tiên · Những cử chỉ dịu dàng",
    "intro": "Giữa không gian lễ gia tiên, một cử chỉ dịu dàng trở thành điều đáng nhớ. Mình lưu lại cả những chi tiết nhỏ bên cạnh khoảnh khắc của hai người."
  },
  "f80819d221858f1f3093537114d08320": {
    "slug": "celebrating-love",
    "original": "Celebrating love and unforgettable moments. Photographed for HayDay.",
    "summary": "Áo dài đỏ · Nắm tay trong ngày vui",
    "intro": "Hai người trong tà áo dài đỏ, nắm tay và mỉm cười với nhau. Một cách giản dị để nhớ về niềm vui của ngày cưới."
  },
  "d9e805527691bae6b4ce8cf6357fb907": {
    "slug": "traditional-wedding",
    "original": "Follow my passion for traditional photography. Photographed for HayDay Media.",
    "summary": "Lễ vu quy · Những nụ cười chung khung hình",
    "intro": "Lễ vu quy không chỉ có hai người. Những nụ cười cùng xuất hiện trong một khung hình cũng làm nên câu chuyện của ngày vui."
  },
  "4c5afcfeff9518b24e9da470aeb58fd8": {
    "slug": "a-wedding-story",
    "original": "Wedding photography by Chí Công. Photographed for HayDay Media.",
    "summary": "Ngày cưới · Những khoảnh khắc gần nhau",
    "intro": "Một nụ hôn nhẹ và nụ cười khi ở cạnh nhau. Những khoảnh khắc gần gũi là điều mình muốn giữ lại trong câu chuyện ngày cưới này."
  }
};

export function albumEditorial(album) {
  const entry = stories[album.id] || Object.values(stories).find(story => story.slug === album.slug);
  return entry && album.description === entry.original ? entry : null;
}

export const photoAlt = {
  "4e4b43d65bfd6c5e82dd68255c92229c": "Chú rể hôn lên trán cô dâu mặc áo dài trắng trong lễ đính hôn",
  "9040199edb35c437104cc9a221e6a807": "Cô dâu cầm micro nhìn chú rể trong buổi lễ",
  "a689883c61c27506a600c1a91719975f": "Cặp đôi trong áo dài trắng bên bàn thờ gia tiên",
  "66ee077da0c45a7dfe1c2ec935638585": "Cặp đôi mặc áo dài đỏ nắm tay và mỉm cười với nhau",
  "b9e919abee3314b45d0428cac82d90c0": "Cô dâu chú rể chụp ảnh cùng mọi người trước phông lễ vu quy",
  "b0a03a1768031ac519fd4aeb64e93557": "Chú rể hôn má cô dâu đang mỉm cười trong váy cưới"
};

// Re-importing preserves verified captions and dimensions, but generates new IDs.
const importedPhotos = [
  {
    "id": "4e4b43d65bfd6c5e82dd68255c92229c",
    "caption": "Ceremony | T & T · 041",
    "width": 1366,
    "height": 2048
  },
  {
    "id": "9040199edb35c437104cc9a221e6a807",
    "caption": "A New Chapter of Love · 023",
    "width": 1366,
    "height": 2048
  },
  {
    "id": "a689883c61c27506a600c1a91719975f",
    "caption": "Love in the Details · 027",
    "width": 1366,
    "height": 2048
  },
  {
    "id": "66ee077da0c45a7dfe1c2ec935638585",
    "caption": "Celebrating Love · 006",
    "width": 1366,
    "height": 2048
  },
  {
    "id": "b9e919abee3314b45d0428cac82d90c0",
    "caption": "Traditional Wedding · 029",
    "width": 2048,
    "height": 1366
  },
  {
    "id": "b0a03a1768031ac519fd4aeb64e93557",
    "caption": "A Wedding Story · 037",
    "width": 1366,
    "height": 2048
  }
];

export function photoDescription(photo) {
  const original = importedPhotos.find(reference => reference.id === photo.id);
  if (original && photo.caption !== original.caption) return photo.caption;
  const reference = importedPhotos.find(candidate =>
    candidate.caption === photo.caption && candidate.width === photo.width && candidate.height === photo.height
  );
  return photoAlt[photo.id] || photoAlt[reference?.id] || photo.caption;
}
