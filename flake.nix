{
  description = "WunderGraph Cosmo development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        
        nodejs = pkgs.nodejs_22;
        
        # Common Node.js packages
        nodeTools = with pkgs; [
          nodejs
          nodePackages.pnpm
          nodePackages.typescript
          nodePackages.typescript-language-server
          nodePackages.prettier
        ];
        
        # Go development packages
        goPackages = with pkgs; [
          go_1_23
          gopls
          gotools
          go-tools
          delve
          golangci-lint
        ];
        
        # Protocol buffer tools
        protoPackages = with pkgs; [
          buf
          protobuf
          protoc-gen-go
          protoc-gen-go-grpc
        ];
        
        # Core development tools
        coreTools = with pkgs; [
          git
          gnumake
          jq
          yq-go
          curl
          wget
        ];
        
        # Database and infrastructure
        databaseTools = with pkgs; [
          postgresql_16
          clickhouse
          redis
        ];
        
        # Container and orchestration
        containerTools = with pkgs; [
          docker
          docker-compose
          kubectl
          kubernetes-helm
        ];
        
        # Monitoring and messaging
        monitoringTools = with pkgs; [
          prometheus
          grafana
          nats-server
          natscli
        ];
        
        # Testing and AWS
        testingTools = with pkgs; [
          k6
          awscli2
        ];
        
        # Shell hook helper function
        mkShellHook = { name, tools ? [] }: ''
          echo "🚀 ${name}"
          ${builtins.concatStringsSep "\n" (map (t: t) tools)}
          echo ""
        '';
        
        # Common environment setup
        commonEnvSetup = ''
          # Set up Go environment
          export GOPATH="$HOME/go"
          export PATH="$GOPATH/bin:$PATH"
          
          # Set up Node environment
          export NODE_OPTIONS="--max-old-space-size=8192"
          
          # Ensure pnpm is using the correct Node version
          export PNPM_NODE_VERSION="${nodejs.version}"
        '';
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = 
            nodeTools ++
            goPackages ++
            protoPackages ++
            databaseTools ++
            containerTools ++
            coreTools ++
            monitoringTools ++
            testingTools;

          shellHook = ''
            echo "🚀 WunderGraph Cosmo Development Environment"
            echo ""
            echo "Available tools:"
            echo "  • Node.js: ${nodejs.version}"
            echo "  • pnpm: $(pnpm --version 2>/dev/null || echo "not installed")"
            echo "  • Go: $(go version | cut -d' ' -f3)"
            echo "  • Buf: $(buf --version 2>/dev/null || echo "not installed")"
            echo "  • Docker: $(docker --version 2>/dev/null | cut -d' ' -f3 || echo "not installed")"
            echo "  • Helm: $(helm version --short 2>/dev/null || echo "not installed")"
            echo ""
            echo "Quick start:"
            echo "  • Install dependencies: pnpm install"
            echo "  • Build all packages: pnpm build"
            echo "  • Run tests: pnpm test"
            echo "  • Start local demo: ./scripts/create-local-demo.sh"
            echo ""
            
            ${commonEnvSetup}
            
            # Set up npm prefix for local installations
            export NPM_CONFIG_PREFIX="$HOME/.npm-global"
            export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
            mkdir -p "$NPM_CONFIG_PREFIX"
            
            # Install wgc locally if not already installed
            if ! command -v wgc &> /dev/null; then
              echo "Installing wgc CLI locally..."
              npm install -g --prefix "$NPM_CONFIG_PREFIX" wgc@latest
            fi
          '';

          # Environment variables
          DOCKER_BUILDKIT = "1";
          COMPOSE_DOCKER_CLI_BUILD = "1";
          DO_NOT_TRACK = "1";
        };
        
        # Additional shell for CI/CD environments
        devShells.ci = pkgs.mkShell {
          buildInputs = 
            [ nodejs pkgs.nodePackages.pnpm ] ++
            [ pkgs.go_1_23 pkgs.golangci-lint ] ++
            [ pkgs.buf pkgs.protobuf ] ++
            [ pkgs.git pkgs.gnumake pkgs.jq ];
        };
        
        # Minimal shell for router development
        devShells.router = pkgs.mkShell {
          buildInputs = goPackages ++ [ pkgs.gnumake pkgs.git pkgs.jq pkgs.curl ];
          
          shellHook = ''
            echo "🚀 Cosmo Router Development Environment"
            echo "Go version: $(go version)"
            echo ""
            echo "Router commands:"
            echo "  • Build: make -C router build"
            echo "  • Test: make -C router test"
            echo "  • Run: make -C router run"
            
            ${commonEnvSetup}
          '';
        };
        
        # Shell for frontend development
        devShells.frontend = pkgs.mkShell {
          buildInputs = nodeTools ++ [ pkgs.git ];
          
          shellHook = ''
            echo "🎨 Cosmo Frontend Development Environment"
            echo "Node.js version: ${nodejs.version}"
            echo ""
            echo "Frontend commands:"
            echo "  • Install: pnpm install"
            echo "  • Dev server: pnpm -F studio dev"
            echo "  • Build: pnpm -F studio build"
            
            ${commonEnvSetup}
          '';
        };
      });
}