# Rentcamera Booking Backend

Simple booking backend for `rentcamera` using Express and SQLite.

## Setup

1. Buka folder `rentcamera` di terminal.
2. Jalankan:
   ```bash
   npm install
   npm start
   ```
3. Buka `http://localhost:3000` di browser.

## Fitur

- API `GET /api/cameras` mengembalikan daftar kamera beserta tanggal `booked`.
- API `POST /api/book` menyimpan booking baru ke SQLite.
- Frontend sekarang terhubung ke database nyata.

## Catatan

- File database SQLite: `rentcamera.db`
- File ini diabaikan oleh `.gitignore` sehingga tidak ikut commit.
