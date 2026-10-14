import sharp from 'sharp';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';

// Real encoded pixels, not a small JPEG with trailing padding.
export async function largeJpeg(){
 const jpeg=await sharp(randomBytes(2100*1800*3),{raw:{width:2100,height:1800,channels:3}}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();
 assert.ok(jpeg.length>10*1024*1024&&jpeg.length<20*1024*1024,'Fixture must exercise a genuine JPEG between 10 and 20 MiB');
 return jpeg;
}
