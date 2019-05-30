#!/bin/sh
echo "\n------------" &&
echo "$(date)\n" &&
pm2 stop 0 &&
rm -rf piradio &&
git clone https://github.com/metalinux91/piradio.git &&
sudo apt-get update &&
sudo apt-get install -y mpv &&
cd ~/piradio &&
npm install &&
git checkout package-lock.json &&
pm2 start piradio/ecosystem.json
