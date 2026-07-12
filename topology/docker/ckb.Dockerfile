FROM nervos/ckb:v0.207.0

ARG FIBER_TAG=v0.8.0
ARG FIBER_CONTRACTS_URL=https://raw.githubusercontent.com/nervosnetwork/fiber/${FIBER_TAG}/tests/deploy/contracts

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /fiber-scripts \
    && for c in auth funding-lock commitment-lock simple_udt xudt_rce always_success; do \
         curl -fsSL --retry 8 --retry-delay 5 \
              -o "/fiber-scripts/$c" "${FIBER_CONTRACTS_URL}/$c" \
         && sleep 3; \
       done

COPY ckb/dev.toml /flab/dev.toml
COPY ckb/entrypoint.sh /usr/local/bin/flab-ckb-entrypoint.sh
RUN chmod +x /usr/local/bin/flab-ckb-entrypoint.sh

ENV CKB_DATA_DIR=/var/lib/ckb
EXPOSE 8114 8115

ENTRYPOINT ["/usr/local/bin/flab-ckb-entrypoint.sh"]
