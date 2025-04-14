export default async function loadXmlRfc(rfcNum) {
  if (rfcNum < 8650) {
    throw new Error(`No official XML version for RFC ${rfcNum}`);
  }
  try {
    const res = await fetch(`https://www.rfc-editor.org/rfc/rfc${rfcNum}.xml`);
    if (res.status !== 200) {
      throw new Error(`HTTP Error fetching RFC ${rfcNum}: ${res.status}`);
    }
    return res.text();
  } catch (e) {
    throw new Error(`Error fetching RFC ${rfcNum}: ${e.message}`, { cause: e});
  }
}
