#~/bin/sh
echo "\n------------" &&
echo "$(date)\n" &&
cd ~/piradio &&
git pull origin master &&
npm install &&
git checkout package-lock.json &&
pm2 restart 0
