FROM debian:bookworm-slim

ARG FNN_VERSION=v0.8.0
ARG FNN_ARCHIVE=fnn_v0.8.0-x86_64-linux-portable.tar.gz

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl libssl3 libstdc++6 tini \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o /tmp/fnn.tar.gz \
        "https://github.com/nervosnetwork/fiber/releases/download/${FNN_VERSION}/${FNN_ARCHIVE}" \
    && tar -xzf /tmp/fnn.tar.gz -C /tmp \
    && mv /tmp/fnn /tmp/fnn-cli /tmp/fnn-migrate /usr/local/bin/ \
    && rm -rf /tmp/fnn.tar.gz /tmp/config

WORKDIR /fiber
ENV BASE_DIR=/fiber

EXPOSE 8227 8228

ENTRYPOINT ["/usr/bin/tini", "--", "fnn"]
CMD []
