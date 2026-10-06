server {
    server_name kairox.fun www.kairox.fun;
    root /var/www/kairox.fun;
    index index.html;
    location / {
        try_files $uri $uri/ =404;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/kairox.fun/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/kairox.fun/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot


}
server {
    if ($host = www.kairox.fun) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    if ($host = kairox.fun) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name kairox.fun www.kairox.fun;
    return 404; # managed by Certbot




}