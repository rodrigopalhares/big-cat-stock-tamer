{
  description = "Stocks portfolio manager - Kotlin/Spring Boot";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            jdk21
            gradle
            kotlin
          ];

          shellHook = ''
            export JAVA_HOME=${pkgs.jdk21}
            echo "Java: $(java --version 2>&1 | head -1)"
            echo "Gradle: $(gradle --version 2>&1 | grep '^Gradle' || echo 'available')"
          '';
        };
      });
}
