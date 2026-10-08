export const siteDefaults={
 brand:'ChiCong',name:'Chí Công',tagline:'Wedding Photographer',
 headline:'Ngày cưới qua đi.\nCảm xúc ở lại.',
 intro:'Chí Công — nhiếp ảnh cưới bằng film và máy số, với hơn 5 năm kinh nghiệm. Xem những bộ ảnh đã thực hiện và trao đổi về ngày cưới của bạn.',
 about:'Mình là Chí Công. Hơn 5 năm làm việc trong lĩnh vực ảnh cưới đã cho mình cơ hội đồng hành cùng hàng trăm cặp dâu rể.\n\nMình tin rằng một bộ ảnh đáng nhớ bắt đầu từ sự thoải mái của hai bạn. Mình muốn ghi lại những cảm xúc tự nhiên, những người thân yêu và cả những chi tiết nhỏ dễ bị bỏ qua trong ngày cưới.\n\nTrước buổi chụp, mình cùng hai bạn trao đổi về lịch trình và những khoảnh khắc quan trọng. Hai bạn được là chính mình, còn những điều đáng nhớ, hãy để mình ghi lại.',
 email:'',phone:'',location:'',instagram:'',facebook:'',zalo:'',portrait:'',
 bookingNote:'Kể mình nghe về ngày cưới của hai bạn. Mình sẽ tư vấn cách chụp phù hợp và gửi báo giá riêng. Chưa chốt ngày hay ngân sách cũng không sao.',
 heroSelection:'',storySelection:'',responseNote:''
};
export const legacyCopy={
 tagline:'Photography & stories',headline:'Những câu chuyện xứng đáng được lưu giữ.',
 intro:'Một góc nhìn riêng. Những khoảnh khắc chân thật. Khám phá portfolio và cùng lên ý tưởng cho buổi chụp của bạn.',
 about:'Mỗi bộ ảnh bắt đầu từ một cuộc trò chuyện. Chia sẻ với mình về điều bạn muốn lưu giữ, để cùng tạo nên một câu chuyện mang dấu ấn riêng.',
 bookingNote:'Gửi yêu cầu để trao đổi và xác nhận lịch chụp. Yêu cầu chưa phải là lịch hẹn đã được xác nhận.'
};
export function currentCopy(values){
 const result={...siteDefaults,...values};
 for(const [key,old] of Object.entries(legacyCopy))if(result[key]===old)result[key]=siteDefaults[key];
 if(result.about==='Mình là Chí Công, một nhiếp ảnh gia với hơn 5 năm chụp ảnh cưới. Mình chụp bằng film và máy số, ghi lại cả lễ cưới, gia đình, bạn bè và những điều nhỏ làm nên ngày của bạn.')result.about=siteDefaults.about;
 if(result.bookingNote==='Kể mình nghe một chút về hai bạn và ngày cưới dự kiến. Chưa có đủ thông tin cũng không sao.')result.bookingNote=siteDefaults.bookingNote;
 if(result.about==='Với hơn 5 năm trong lĩnh vực ảnh cưới và cơ hội đồng hành cùng hàng trăm cặp dâu rể, mình tin rằng một bộ ảnh đáng nhớ bắt đầu từ sự thoải mái của hai bạn. Mình là Chí Công, tập trung chụp ngày cưới: từ những phút chuẩn bị, lễ gia tiên đến khoảnh khắc bên gia đình và bạn bè. Mình muốn để hai bạn được là chính mình, còn những cảm xúc và chi tiết nhỏ trong ngày, hãy để mình ghi lại.')result.about=siteDefaults.about;
 if(result.bookingNote==='Chia sẻ dự định và ngân sách của hai bạn qua form bên dưới. Mình sẽ trao đổi để tư vấn cách chụp phù hợp và gửi báo giá riêng. Chưa chốt ngày hay ngân sách cũng không sao.')result.bookingNote=siteDefaults.bookingNote;
 return result;
}
