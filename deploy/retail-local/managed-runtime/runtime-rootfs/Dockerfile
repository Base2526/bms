ARG UBUNTU_IMAGE
FROM ${UBUNTU_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    age \
    docker.io \
    docker-compose-v2 \
    iptables \
    systemd \
    systemd-sysv \
  && systemctl enable docker.service containerd.service \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/* /tmp/*

COPY wsl.conf /etc/wsl.conf
COPY daemon.json /etc/docker/daemon.json
COPY bms-wsl-keepalive /usr/local/sbin/bms-wsl-keepalive
COPY bms-localctl /usr/local/bin/bms-localctl
COPY bms-update-transaction /usr/local/sbin/bms-update-transaction

RUN chmod 0755 /usr/local/sbin/bms-wsl-keepalive /usr/local/sbin/bms-update-transaction /usr/local/bin/bms-localctl \
  && mkdir -p /var/lib/bms-retail-local \
  && chmod 0700 /var/lib/bms-retail-local

LABEL org.opencontainers.image.title="BMS Retail Local WSL Runtime" \
      org.opencontainers.image.description="Private Moby runtime root filesystem; contains no shop data or credentials"
