#~/bin/sh
echo "\n------------" &&
echo "$(date)\n" &&
rm -rf piradio
git clone https://github.com/metalinux91/piradio.git &&
cd ~/piradio &&
npm install &&
git checkout package-lock.json &&
pm2 start piradio/ecosystem.json
