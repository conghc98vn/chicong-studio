// Shared labels keep the website, admin, metadata and emails in sync.
// Keys are stored API values; changing a label must not change saved data.
export const categoryLabels={wedding:'Ngày cưới',prewedding:'Ảnh trước ngày cưới',portrait:'Chân dung',lifestyle:'Đời thường'};
export const albumStatusLabels={draft:'Bản nháp',published:'Công khai',private:'Bộ ảnh riêng',archived:'Đã lưu trữ'};
export const inquiryStatusLabels={new:'Mới nhận',contacted:'Đã liên hệ',confirmed:'Đã xác nhận lịch',completed:'Hoàn thành',cancelled:'Đã hủy'};
export const selectionStatusLabels={draft:'Đang chọn ảnh',submitted:'Đã gửi lựa chọn'};
export const inquiryNotice='Gửi yêu cầu tư vấn chưa có nghĩa là đã giữ lịch chụp. Lịch chỉ được xác nhận sau khi hai bên trao đổi và thống nhất.';
export const budgetLabels={'Dưới 10tr':'Dưới 10 triệu đồng','10tr - 20tr':'Từ 10 đến 20 triệu đồng','Trên 20tr':'Trên 20 triệu đồng'};
export const budgetLabel=value=>Object.hasOwn(budgetLabels,value)?budgetLabels[value]:value||'Chưa xác định';
