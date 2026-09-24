export function sum(values) {
  return values.reduce((acc, value) => acc + Number(value), 0);
}

export function format(total) {
  return `Total: ${total}`;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  console.log(format(sum(process.argv.slice(2))));
}
