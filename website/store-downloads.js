// Only show official download badges once their public pages have been verified.
const urls = {
  appStore: 'https://apps.apple.com/app/id6831551843',
  googlePlay: 'https://play.google.com/store/apps/details?id=com.silvergridtech.famcall',
};
fetch('/store-links.json', { cache: 'no-store' }).then(response => {
  if (!response.ok) throw new Error('Store availability unavailable');
  return response.json();
}).then(stores => {
  const available = [];
  for (const name of Object.keys(urls)) {
    const link = document.getElementById(name);
    if (link && stores[name]?.url === urls[name] && stores[name]?.available === true) {
      link.hidden = false;
      available.push(name);
    }
  }
  const status = document.getElementById('store-availability');
  if (status && available.length) status.textContent = available.length === 2
    ? 'Available for iPhone and Android.'
    : available[0] === 'appStore'
      ? 'Available for iPhone. Google Play release coming soon.'
      : 'Available for Android. App Store release coming soon.';
  document.getElementById('stores-coming-soon').hidden = available.length > 0;
}).catch(() => { /* Keep the honest coming-soon state if the check is unavailable. */ });
