export async function onRequest(context) {
 const url = new URL(context.request.url);
 if (url.hostname === 'vn-keen.pages.dev' || url.hostname === 'www.vn-keen.skin') {url.hostname = 'vn-keen.skin';url.protocol = 'https:';return Response.redirect(url.toString(),308);}
 const blocked = ['/VN-KEEN-PAGES.zip','/wrangler.toml','/package.json','/tsconfig.json','/README.md'];
 if (blocked.includes(url.pathname)) return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
 if (['/essentials','/essentials.html'].includes(url.pathname)) return Response.redirect('https://vn-keen.skin/#contact',302);
 if (['/licensegate-checkout','/licensegate-checkout.html'].includes(url.pathname)) return Response.redirect('https://vn-keen.skin/#pricing',302);
 if (['/VN-KEEN.SKIN-V2.1.5-INSERT-HUONG-DAN-MOI.zip','/VN-KEEN.SKIN.V2.1.5-SAVED-KEY.zip'].includes(url.pathname)) return Response.redirect('https://vn-keen.skin/VN-KEEN.SKIN-CS2-V2.1.6.zip',302);
 if (/^\/VN-KEEN.*\.(zip|exe|dll|rar|7z)$/i.test(url.pathname) && url.pathname !== '/VN-KEEN.SKIN-CS2-V2.1.6.zip') return new Response('Bản tải cũ đã ngừng cung cấp. Truy cập https://vn-keen.skin/ để tải bản mới.',{status:410,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
 return context.next();
}
