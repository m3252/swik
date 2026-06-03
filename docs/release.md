# Release Notes

## npm

1. update `version` in `package.json`
2. run `npm test`
3. run `npm pack --dry-run`
4. publish with `npm publish --access public`

## Homebrew

After the first npm or GitHub release, create a separate tap repository:

```text
homebrew-ai-switch/
  Formula/
    ai-switch.rb
```

Example formula shape:

```ruby
class AiSwitch < Formula
  desc "Switch project instructions, MCP settings, and skills between AI coding agents"
  homepage "https://github.com/m3252/ai-switch"
  url "https://registry.npmjs.org/ai-switch/-/ai-switch-0.1.0.tgz"
  sha256 "<sha256>"
  license "MIT"

  depends_on "node"

  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"src/cli.js" => "ai-switch"
  end

  test do
    system "#{bin}/ai-switch", "--version"
  end
end
```
