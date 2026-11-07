"""Build a standalone diagnostic APK using only the installed Android/JDK tools."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[3]
SOURCE = Path(__file__).resolve().parent
OUT = ROOT / ".local/linux-audio-fixture/build"
SDK = Path(os.environ["ANDROID_HOME"])
JAVA = Path(os.environ["JAVA_HOME"]) / "bin"
TOOLS = SDK / "build-tools/36.0.0"
ANDROID = SDK / "platforms/android-36/android.jar"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    for name in ("classes", "dex"):
        (OUT / name).mkdir(parents=True, exist_ok=True)
    with (OUT / "build.log").open("w") as log:
        def run(*args):
            subprocess.run([str(x) for x in args], check=True, stdout=log, stderr=log)

        run(JAVA / "javac", "-source", "8", "-target", "8", "-classpath", ANDROID,
            "-d", OUT / "classes", SOURCE / "MainActivity.java")
        run(TOOLS / "d8", "--min-api", "34", "--lib", ANDROID, "--output", OUT / "dex",
            *sorted((OUT / "classes").rglob("*.class")))
        run(TOOLS / "aapt2", "link", "-o", OUT / "unsigned.apk", "-I", ANDROID,
            "--manifest", SOURCE / "AndroidManifest.xml")
        with zipfile.ZipFile(OUT / "unsigned.apk", "a") as archive:
            archive.write(OUT / "dex/classes.dex", "classes.dex")
        run(TOOLS / "zipalign", "-f", "4", OUT / "unsigned.apk", OUT / "aligned.apk")
        key = OUT / "fixture.keystore"
        if not key.exists():
            run(JAVA / "keytool", "-genkeypair", "-keystore", key, "-storepass", "android",
                "-keypass", "android", "-alias", "fixture", "-dname", "CN=Disposable Audio Fixture",
                "-keyalg", "RSA", "-keysize", "2048", "-validity", "30")
        run(TOOLS / "apksigner", "sign", "--ks", key, "--ks-pass", "pass:android",
            "--key-pass", "pass:android", "--out", OUT / "fixture.apk", OUT / "aligned.apk")
        run(TOOLS / "apksigner", "verify", OUT / "fixture.apk")
    record = {"apkSha256": sha(OUT / "fixture.apk"), "androidJarSha256": sha(ANDROID),
              "sources": {str(p.relative_to(ROOT)): sha(p) for p in
                          (SOURCE / "MainActivity.java", SOURCE / "AndroidManifest.xml", Path(__file__))}}
    (OUT / "provenance.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record))


if __name__ == "__main__":
    main()
