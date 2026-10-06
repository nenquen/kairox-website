server {
    server_name status.kairox.fun;
    root /var/www/status.kairox.fun;
    index index.html;
    location / {
        try_files $uri $uri/ =404;
    }
    location = /api.json {
        add_header Cache-Control "no-store";
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/status.kairox.fun/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/status.kairox.fun/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}
server {
    if ($host = status.kairox.fun) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name status.kairox.fun;
    return 404; # managed by Certbot


}