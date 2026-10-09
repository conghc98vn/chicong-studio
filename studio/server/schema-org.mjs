export function buildSchemaOrg({site,album,url,imagePhoto,path}){
 const siteUrl=url.replace(/\/$/,'');
 const sameAs=[site.instagram,site.facebook,site.zalo].filter(Boolean);
 const studio={
  '@type':'PhotographyBusiness',
  '@id':siteUrl+'/#studio',
  name:site.brand||'ChiCong',
  alternateName:site.name||'Chí Công',
  description:site.intro||'',
  url:siteUrl,
  ...(site.phone?{telephone:site.phone}:{}),
  ...(site.email?{email:site.email}:{}),
  ...(imagePhoto?{image:siteUrl+'/media/'+imagePhoto}:{}),
  address:{
   '@type':'PostalAddress',
   addressCountry:'VN',
   ...(site.location?{addressLocality:site.location}:{})
  },
  priceRange:'$$',
  knowsAbout:[
   'Wedding Photography',
   'Pre-wedding',
   'Phóng sự cưới',
   'Chụp ảnh cưới',
   'Couple Photography'
  ],
  founder:{
   '@type':'Person',
   name:site.name||'Chí Công',
   jobTitle:site.tagline||'Wedding Photographer'
  },
  ...(sameAs.length?{sameAs}:{})
 };

 if(path.startsWith('/album/')&&album&&album.status==='published'){
  const categoryLabels={
   wedding:'Ngày cưới',
   prewedding:'Pre-wedding',
   couple:'Couple',
   portrait:'Chân dung',
   story:'Câu chuyện'
  };
  return {
   '@context':'https://schema.org',
   '@graph':[
    studio,
    {
     '@type':'ImageGallery',
     '@id':siteUrl+'/album/'+album.slug+'#gallery',
     url:siteUrl+'/album/'+album.slug,
     name:album.title,
     headline:album.title,
     description:album.description||site.intro||'',
     genre:categoryLabels[album.category]||album.category,
     author:{'@id':siteUrl+'/#studio'},
     creator:{
      '@type':'Person',
      name:site.name||'Chí Công'
     },
     ...(imagePhoto?{image:siteUrl+'/media/'+imagePhoto}:{}),
     inLanguage:'vi'
    }
   ]
  };
 }

 const pageTypes={
  '/':'WebSite',
  '/portfolio':'CollectionPage',
  '/about':'AboutPage',
  '/contact':'ContactPage'
 };
 const pageType=pageTypes[path]||'WebPage';
 const pageName=path==='/'
  ?(site.brand+' · '+site.tagline)
  :(path==='/portfolio'?'Bộ ảnh · '+site.brand
  :(path==='/about'?'Giới thiệu · '+site.brand
  :(path==='/contact'?'Liên hệ & đặt lịch · '+site.brand
  :site.brand)));

 return {
  '@context':'https://schema.org',
  '@graph':[
   studio,
   {
    '@type':pageType,
    '@id':siteUrl+(path==='/'?'':path)+'#page',
    url:siteUrl+(path==='/'?'':path),
    name:pageName,
    description:site.intro||'',
    isPartOf:{
     '@type':'WebSite',
     '@id':siteUrl+'/#website',
     name:site.brand||'ChiCong',
     url:siteUrl
    },
    about:{'@id':siteUrl+'/#studio'},
    inLanguage:'vi'
   }
  ]
 };
}

export function schemaOrgScript(data){
 if(!data)return '';
 return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g,'\\u003c')}</script>`;
}
