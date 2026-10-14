// Shared browser/server input limit; rendition quality is configured separately.
export const maxUploadBytes=20*1024*1024;
export const uploadSizeLabel='20 MB';
export const isPreparedPhotoFile=file=>/\.ccphoto$/i.test(file.name||'');
