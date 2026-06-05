const LINE = "-".repeat(56);

export const output = {
  section(title: string): void {
    console.log(`\n${title}`);
    console.log(LINE);
  },

  step(message: string): void {
    console.log(`> ${message}`);
  },

  success(message: string): void {
    console.log(`OK ${message}`);
  },

  warning(message: string): void {
    console.log(`WARN ${message}`);
  },

  error(message: string): void {
    console.error(`ERROR ${message}`);
  },

  keyValue(key: string, value: string | number): void {
    console.log(`${key.padEnd(18)} ${value}`);
  }
};
