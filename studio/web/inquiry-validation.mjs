// Shared validation keeps public form errors consistent with the API.
export function validateInquiry(input, today = '') {
 const limits={name:100,email:150,phone:30,date:10,service:100,budget:100,message:5000};
 const data={},fields={};
 for(const [key,max] of Object.entries(limits)){
  data[key]=typeof input[key]==='string'?input[key].trim():'';
  if(input[key]!=null&&(typeof input[key]!=='string'||input[key].length>max))fields[key]=`Vui lòng nhập tối đa ${max} ký tự.`;
 }
 if(!data.name)fields.name='Bạn cho mình biết tên để tiện xưng hô nhé.';
 if(!data.email&&!data.phone)fields.email='Để lại email hoặc số điện thoại để mình phản hồi.';
 if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))fields.email='Email chưa hợp lệ. Bạn có thể sửa hoặc bỏ trống nếu đã cung cấp điện thoại.';
 const digits=data.phone.replace(/\D/g,'');
 if(data.phone&&(!/^\+?[0-9 ()-]+$/.test(data.phone)||digits.length<8||digits.length>15))fields.phone='Số điện thoại chưa hợp lệ. Bạn có thể sửa hoặc bỏ trống nếu đã cung cấp email.';
 if(data.date&&(!/^\d{4}-\d{2}-\d{2}$/.test(data.date)||Number.isNaN(Date.parse(data.date))||new Date(data.date).toISOString().slice(0,10)!==data.date||(today&&data.date<today)))fields.date='Vui lòng chọn ngày hợp lệ từ hôm nay trở đi.';
 if(!data.service)fields.service='Bạn chọn cách chụp hoặc mục cần tư vấn thêm nhé.';
 if(data.message.length<10)fields.message='Chia sẻ thêm một chút về dự định hoặc câu hỏi của bạn (ít nhất 10 ký tự).';
 return {data,fields};
}
