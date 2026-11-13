import { generateKeyPairSync, sign } from "node:crypto";
const der = (tag: number, contents: Buffer): Buffer =>
  Buffer.concat([
    Buffer.from([tag]),
    contents.length < 128
      ? Buffer.from([contents.length])
      : (() => {
          const hex = contents.length.toString(16).padStart(4, "0");
          return Buffer.concat([Buffer.from([0x82]), Buffer.from(hex, "hex")]);
        })(),
    contents,
  ]);
const seq = (...items: Buffer[]): Buffer => der(0x30, Buffer.concat(items));
const oid = (hex: string): Buffer => der(6, Buffer.from(hex, "hex"));
const algorithm = (): Buffer => seq(oid("2a864886f70d01010b"), der(5, Buffer.alloc(0)));
/** Ephemeral self-signed key used only by loopback TLS regression, never installed as a trust root. */
export function localTlsIdentity(): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const name = seq(der(0x31, seq(oid("550403"), der(0x0c, Buffer.from("localhost")))));
  const utc = (time: number): Buffer =>
    der(0x17, Buffer.from(new Date(time).toISOString().slice(2, 19).replace(/[-:T]/g, "") + "Z"));
  const extensions = der(
    0xa3,
    seq(
      seq(
        oid("551d11"),
        der(4, seq(der(0x82, Buffer.from("localhost")), der(0x87, Buffer.from([127, 0, 0, 1])))),
      ),
    ),
  );
  const body = seq(
    der(0xa0, der(2, Buffer.from([2]))),
    der(2, Buffer.from([1])),
    algorithm(),
    name,
    seq(utc(Date.now() - 3600000), utc(Date.now() + 86400000)),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    extensions,
  );
  const certificate = seq(
    body,
    algorithm(),
    der(3, Buffer.concat([Buffer.from([0]), sign("sha256", body, privateKey)])),
  );
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    cert: `-----BEGIN CERTIFICATE-----\n${certificate
      .toString("base64")
      .match(/.{1,64}/g)!
      .join("\n")}\n-----END CERTIFICATE-----\n`,
  };
}
