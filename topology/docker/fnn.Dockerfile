FROM debian:bookworm-slim

ARG FNN_VERSION=0.9.1
ARG TARGETARCH
ARG FIBER_CONTRACTS_URL=https://raw.githubusercontent.com/nervosnetwork/fiber/v${FNN_VERSION}/tests/deploy/contracts

RUN apt-get -o Acquire::Retries=5 update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl libssl3 libstdc++6 tini \
    && rm -rf /var/lib/apt/lists/*

RUN case "${TARGETARCH:-amd64}" in \
        amd64) arch=x86_64 ;; \
        arm64) arch=aarch64 ;; \
        *) echo "FNN has no Linux release for ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL --retry 30 --retry-delay 10 --retry-all-errors -o /tmp/fnn.tar.gz \
        "https://github.com/nervosnetwork/fiber/releases/download/v${FNN_VERSION}/fnn_v${FNN_VERSION}-${arch}-linux-portable.tar.gz" \
    && tar -xzf /tmp/fnn.tar.gz -C /tmp \
    && mv /tmp/fnn /tmp/fnn-cli /usr/local/bin/ \
    && { [ ! -f /tmp/fnn-migrate ] || mv /tmp/fnn-migrate /usr/local/bin/; } \
    && rm -rf /tmp/fnn.tar.gz /tmp/config

RUN mkdir -p /fiber-scripts \
    && for c in auth funding-lock commitment-lock simple_udt xudt_rce; do \
         curl -fsSL --retry 30 --retry-delay 10 --retry-all-errors \
              -o "/fiber-scripts/$c" "${FIBER_CONTRACTS_URL}/$c" \
         && sleep 3; \
       done
COPY ckb/dev.toml /flab/dev.toml
COPY fnn/entrypoint.sh /usr/local/bin/flab-fnn-entrypoint.sh
RUN chmod +x /usr/local/bin/flab-fnn-entrypoint.sh

WORKDIR /fiber
ENV BASE_DIR=/fiber

EXPOSE 8227 8228

ENTRYPOINT ["/usr/bin/tini", "--", "bash", "/usr/local/bin/flab-fnn-entrypoint.sh"]
CMD []
