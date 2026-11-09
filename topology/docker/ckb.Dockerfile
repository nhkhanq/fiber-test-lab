ARG CKB_VERSION=0.207.0
ARG FNN_VERSION=0.9.1

FROM debian:bookworm-slim AS contracts
ARG FNN_VERSION
ARG FIBER_CONTRACTS_URL=https://raw.githubusercontent.com/nervosnetwork/fiber/v${FNN_VERSION}/tests/deploy/contracts
RUN apt-get -o Acquire::Retries=5 update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /fiber-scripts \
    && for c in auth funding-lock commitment-lock simple_udt xudt_rce always_success; do \
         curl -fsSL --retry 8 --retry-delay 5 --retry-all-errors \
              -o "/fiber-scripts/$c" "${FIBER_CONTRACTS_URL}/$c" \
         && sleep 3; \
       done

FROM nervos/ckb:v${CKB_VERSION}
USER root
COPY --from=contracts /fiber-scripts /fiber-scripts
COPY ckb/dev.toml /flab/dev.toml
COPY ckb/entrypoint.sh /usr/local/bin/flab-ckb-entrypoint.sh
COPY ckb/rpc-ping.sh /usr/local/bin/flab-ckb-rpc-ping.sh
RUN chmod +x /usr/local/bin/flab-ckb-entrypoint.sh

ENV CKB_DATA_DIR=/var/lib/ckb
EXPOSE 8114 8115

ENTRYPOINT ["bash", "/usr/local/bin/flab-ckb-entrypoint.sh"]
