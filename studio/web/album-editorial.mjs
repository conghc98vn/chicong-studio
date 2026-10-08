// Copy for the imported portfolio, based on its verified covers and original credits.
// Custom descriptions take precedence so later studio edits are never replaced.
const stories={
 'c64c0ff5b22f7ca2af5c6b6918e0cfee':{original:'Ceremony | T & T. Photographed for Helios Bridal.',summary:'Lễ đính hôn · Một nụ hôn trên trán',intro:'Tà áo dài trắng, một nụ hôn trên trán và nụ cười trong lễ đính hôn của T & T. Những cử chỉ nhỏ cũng là điều đáng nhớ trong ngày vui.'},
 '91d8e5f65a0ea8c06a876b6702195f26':{original:'Cheers to a new chapter of love! Photography by Chí Công and Trịnh Công Sơn for Le Hoa Bridal.',summary:'Buổi lễ · Ánh nhìn dành cho nhau',intro:'Ánh nhìn và những lời chia sẻ của hai người trong buổi lễ. Một khởi đầu mới được kể bằng những khoảnh khắc bên nhau.'},
 'fe7dac533ee8f0f6be2f276e2fcae9bd':{original:'Love in the details, beauty in every frame. Photographed for Helios Bridal.',summary:'Lễ gia tiên · Những cử chỉ dịu dàng',intro:'Giữa không gian lễ gia tiên, một cử chỉ dịu dàng trở thành điều đáng nhớ. Mình lưu lại cả những chi tiết nhỏ bên cạnh khoảnh khắc của hai người.'},
 'f80819d221858f1f3093537114d08320':{original:'Celebrating love and unforgettable moments. Photographed for HayDay.',summary:'Áo dài đỏ · Nắm tay trong ngày vui',intro:'Hai người trong tà áo dài đỏ, nắm tay và mỉm cười với nhau. Một cách giản dị để nhớ về niềm vui của ngày cưới.'},
 'd9e805527691bae6b4ce8cf6357fb907':{original:'Follow my passion for traditional photography. Photographed for HayDay Media.',summary:'Lễ vu quy · Những nụ cười chung khung hình',intro:'Lễ vu quy không chỉ có hai người. Những nụ cười cùng xuất hiện trong một khung hình cũng làm nên câu chuyện của ngày vui.'},
 '4c5afcfeff9518b24e9da470aeb58fd8':{original:'Wedding photography by Chí Công. Photographed for HayDay Media.',summary:'Ngày cưới · Những khoảnh khắc gần nhau',intro:'Một nụ hôn nhẹ và nụ cười khi ở cạnh nhau. Những khoảnh khắc gần gũi là điều mình muốn giữ lại trong câu chuyện ngày cưới này.'}
};
export function albumEditorial(album){
 const entry=stories[album.id];return entry&&album.description===entry.original?entry:null;
}
export const photoAlt={
 '4e4b43d65bfd6c5e82dd68255c92229c':'Chú rể hôn lên trán cô dâu mặc áo dài trắng trong lễ đính hôn',
 '9040199edb35c437104cc9a221e6a807':'Cô dâu cầm micro nhìn chú rể trong buổi lễ',
 'a689883c61c27506a600c1a91719975f':'Cặp đôi trong áo dài trắng bên bàn thờ gia tiên',
 '66ee077da0c45a7dfe1c2ec935638585':'Cặp đôi mặc áo dài đỏ nắm tay và mỉm cười với nhau',
 'b9e919abee3314b45d0428cac82d90c0':'Cô dâu chú rể chụp ảnh cùng mọi người trước phông lễ vu quy',
 'b0a03a1768031ac519fd4aeb64e93557':'Chú rể hôn má cô dâu đang mỉm cười trong váy cưới'
};
