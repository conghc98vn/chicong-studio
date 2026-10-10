// Shared validation keeps public form errors consistent with the API.
export function validateInquiry(input, today = '') {
 const limits={name:100,email:150,phone:30,date:10,service:100,budget:100,message:5000};
 const data={},fields={};
 for(const [key,max] of Object.entries(limits)){
  data[key]=typeof input[key]==='string'?input[key].trim():'';
  if(input[key]!=null&&(typeof input[key]!=='string'||input[key].length>max))fields[key]=`Vui lòng nhập tối đa ${max} ký tự.`;
 }
 if(!data.name)fields.name='Cho mình biết tên của bạn để tiện xưng hô nhé.';
 if(!data.email&&!data.phone)fields.email='Vui lòng để lại email hoặc số điện thoại để mình liên hệ tư vấn.';
 if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))fields.email='Email chưa hợp lệ. Bạn hãy kiểm tra lại hoặc để trống nếu đã điền số điện thoại.';
 const digits=data.phone.replace(/\D/g,'');
 if(data.phone&&(!/^\+?[0-9 ()-]+$/.test(data.phone)||digits.length<8||digits.length>15))fields.phone='Số điện thoại chưa hợp lệ. Bạn hãy kiểm tra lại hoặc để trống nếu đã điền email.';
 if(data.date&&(!/^\d{4}-\d{2}-\d{2}$/.test(data.date)||Number.isNaN(Date.parse(data.date))||new Date(data.date).toISOString().slice(0,10)!==data.date||(today&&data.date<today)))fields.date='Vui lòng chọn ngày dự kiến từ hôm nay trở đi, hoặc để trống nếu chưa chốt ngày.';
 if(!data.service)fields.service='Bạn chọn cách chụp hoặc chọn mục cần tư vấn thêm nhé.';
 if(data.message.length<10)fields.message='Chia sẻ dự định hoặc câu hỏi của bạn bằng ít nhất 10 ký tự.';
 return {data,fields};
}
