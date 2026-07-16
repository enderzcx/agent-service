import { defineConfig } from 'hardhat/config';

export default defineConfig({
  paths: {
    sources: './contracts/src',
    tests: {
      solidity: './contracts/test'
    },
    cache: './.cache/hardhat',
    artifacts: './.artifacts/solidity'
  },
  solidity: {
    profiles: {
      default: {
        version: '0.8.28',
        preferWasm: true,
        settings: {
          evmVersion: 'paris',
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      },
      production: {
        version: '0.8.28',
        preferWasm: true,
        settings: {
          evmVersion: 'paris',
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    }
  },
  test: {
    solidity: {
      isolate: true
    }
  }
});
