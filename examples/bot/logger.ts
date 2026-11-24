import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import fs from 'fs';
import path from 'path';

const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// 📁 Транспорт для общих логов с ежедневной ротацией
const dailyRotateTransport = new DailyRotateFile({
  filename: path.join(logDir, 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '10m',
  maxFiles: '14d',
});

// 📁 Транспорт для ошибок с отдельной ротацией и долгим хранением
const dailyRotateErrorTransport = new DailyRotateFile({
  filename: path.join(logDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '10m',
  maxFiles: '30d',
  level: 'error',
});

// 🔧 Хелпер для сериализации Ошибок без конфликтов свойств в TypeScript
const errorReplacer = (key: string, value: any) => {
  if (value instanceof Error) {
    const { message, stack, name, ...rest } = value;
    return {
      name,
      message,
      stack,
      ...rest,
    };
  }
  return value;
};

// Кастомный формат для вывода timestamp на первое место в JSON
const orderedJsonFormat = winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
  const orderedLog = {
    timestamp,
    level,
    message,
    ...(stack ? { stack } : {}),
    ...meta,
  };
  return JSON.stringify(orderedLog, errorReplacer);
});

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    orderedJsonFormat
  ),
  defaultMeta: { service: 'telegram-dialog-bot' },
  transports: [
    dailyRotateTransport,
    dailyRotateErrorTransport,
  ],
});

// Вывод в консоль для разработки (красивый и читаемый)
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
          delete meta.service;

          const metaStr = Object.keys(meta).length ? ` | ${JSON.stringify(meta, errorReplacer)}` : '';
          const stackStr = stack ? `\n${stack}` : '';

          return `[${timestamp}] [${level}]: ${message}${metaStr}${stackStr}`;
        })
      ),
    })
  );
}