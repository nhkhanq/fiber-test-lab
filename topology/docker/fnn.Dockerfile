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

ARG FIBER_TAG=v0.8.0
ARG FIBER_CONTRACTS_URL=https://raw.githubusercontent.com/nervosnetwork/fiber/${FIBER_TAG}/tests/deploy/contracts

# fiber-scripts + chain spec: FNN cần để load dev.toml (chain spec trỏ /fiber-scripts/*).
RUN mkdir -p /fiber-scripts \
    && for c in auth funding-lock commitment-lock simple_udt xudt_rce; do \
         curl -fsSL --retry 8 --retry-delay 5 \
              -o "/fiber-scripts/$c" "${FIBER_CONTRACTS_URL}/$c" \
         && sleep 3; \
       done
COPY ckb/dev.toml /flab/dev.toml
COPY fnn/entrypoint.sh /usr/local/bin/flab-fnn-entrypoint.sh
RUN chmod +x /usr/local/bin/flab-fnn-entrypoint.sh

WORKDIR /fiber
ENV BASE_DIR=/fiber

EXPOSE 8227 8228

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/flab-fnn-entrypoint.sh"]
CMD []
