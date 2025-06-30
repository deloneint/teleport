//Импорт данных о станциях метро
import { metroData } from './metro-data.js'

// Конфигурация
const CONFIG = {
    spreadsheetId: '18CV2mGHXk28i6YrXK5R1CaH3BaQHOA45qwi1r07NkzI',
    sheetName: 'Потребность готовый',
    defaultCenter: [55.751244, 37.618423] // Москва
};

let map;
let markers = [];
const geocodeCache = new Map(); // Кеш геокодирования

// Инициализация приложения
async function initApp() {
    showLoading('Загрузка карты...');

    // 1. Инициализация карты 2GIS
    await init2GISMap();

    // 2. Загрузка данных из Google Sheets
    showLoading('Загрузка данных...');
    let sheetData;
    try {
        sheetData = await loadSheetData();
    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
        showError('Не удалось загрузить данные из таблицы');
        return;
    }

    // 3. Обработка и геокодирование адресов
    showLoading('Обработка адресов...');
    const locations = processSheetData(sheetData);
    await addMarkersToMap(locations);

    //4. Инициализация станции метро
    DG.then(() => {
        initMetroControls();
        initMetroSearch();
    })

    hideLoading();
}

// Инициализация карты 2GIS
function init2GISMap() {
    return new Promise((resolve) => {
        DG.then(() => {
            map = DG.map('map', {
                center: CONFIG.defaultCenter,
                zoom: 12
            });
            DG.control.location({ position: 'topright' }).addTo(map);
            resolve();
        });
    });
}

// Загрузка данных из Google Sheets (ваш текущий метод)
async function loadSheetData() {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/gviz/tq?tqx=responseHandler:handleGSData&sheet=${CONFIG.sheetName}`;
        document.head.appendChild(script);

        window.handleGSData = (data) => {
            document.head.removeChild(script);
            delete window.handleGSData;

            if (!data.table || !data.table.rows) {
                reject(new Error('Некорректный формат данных'));
                return;
            }

            const result = [];
            const cols = data.table.cols.map(col => col.label);
            result.push(cols);

            data.table.rows.forEach(row => {
                const values = row.c.map(cell => cell?.v || '');
                result.push(values);
            });

            resolve(result);
        };

        script.onerror = () => {
            reject(new Error('Не удалось загрузить данные'));
        };
    });
}

// Обработка данных таблицы (аналогично вашему коду)
function processSheetData(rows) {
    const headers = rows[0].map(h => h.toString().trim());
    const numberIndex = headers.findIndex(h => h.match('ТК'));
    const addressIndex = headers.findIndex(h => h.match('Адрес'));
    const positionIndex = headers.findIndex(h => h.match('Должность'));
    const countIndex = headers.findIndex(h => h.match('Сколько нужно людей'));
    const cashIndex = headers.findIndex(h => h.match('Тариф'));

    if (addressIndex === -1 || positionIndex === -1 || countIndex === -1 || cashIndex === -1) {
        throw new Error('Не найдены необходимые столбцы в таблице');
    }

    const locationMap = new Map();

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < Math.max(numberIndex, addressIndex, positionIndex, countIndex, cashIndex)) continue;

        const number = parseInt(row[numberIndex]) || 0;
        const address = row[addressIndex]?.toString().trim();
        const position = row[positionIndex]?.toString().trim();
        const count = parseInt(row[countIndex]) || 0;
        const cash = parseInt(row[cashIndex]) || 0;

        if (!address || !position) continue;

        if (!locationMap.has(address)) {
            locationMap.set(address, {
                address: address,
                positions: new Map()
            });
        }

        locationMap.get(address).positions.set(position, {
            count: (locationMap.get(address).positions.get(position)?.count || 0) + count,
            number: number,
            cash: cash
        });
    }

    return Array.from(locationMap.values());
}

// Геокодирование через Яндекс + кеширование
async function geocodeWithYandex(address) {
    if (geocodeCache.has(address)) {
        return geocodeCache.get(address);
    }

    return new Promise((resolve) => {
        ymaps.geocode(address, { results: 1 }).then((res) => {
            const firstResult = res.geoObjects.get(0);
            if (firstResult) {
                const coords = firstResult.geometry.getCoordinates();
                geocodeCache.set(address, coords);
                resolve(coords);
            } else {
                resolve(null);
            }
        });
    });
}

// Добавление маркеров на карту 2GIS
async function addMarkersToMap(locations) {
    let successCount = 0;

    for (let i = 0; i < locations.length; i++) {
        const location = locations[i];
        try {
            showLoading(`Загрузка объектов: ${i + 1} из ${locations.length}...`);

            // 1. Пытаемся найти точный адрес
            let coords = await geocodeWithYandex(location.address);

            // 2. Fallback: если адрес не найден, ищем только улицу
            if (!coords) {
                const streetQuery = location.address.split(/,\s*\d+/)[0];
                coords = await geocodeWithYandex(streetQuery);
                if (coords) {
                    location.address += ' (примерное расположение)';
                }
            }

            if (coords) {
                const marker = createMarker(coords, location);
                marker.addTo(map);
                markers.push(marker);
                successCount++;
            } else {
                console.warn('Не удалось геокодировать:', location.address);
            }
        } catch (error) {
            console.error('Ошибка:', error);
        }
    }

    if (successCount > 0 && markers.length > 0) {
        const group = DG.featureGroup(markers);
        map.fitBounds(group.getBounds());
    } else {
        showError('Не удалось добавить ни одного маркера');
    }
}

// Создание маркера для 2GIS
function createMarker(coords, location) {
    const firstTKNumber = Array.from(location.positions.values())[0]?.number || '';

    const popupContent = `
        <div class="dg-popup">
          <div class="balloon-title">ТК ${firstTKNumber} ${location.address}</div>
          ${Array.from(location.positions.entries()).map(([position, data]) => `
            <div class="position-item">
              <strong>${position}</strong><br>
              Требуется сотрудников: ${data.count}<br>
              Тариф: ${data.cash} руб.
            </div>
          `).join('')}
        </div>
      `;

    return DG.marker(coords, {
        icon: DG.icon({
            iconUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="%23007bff"><path d="M16 0C10.5 0 6 4.5 6 10c0 7 10 22 10 22s10-15 10-22c0-5.5-4.5-10-10-10zm0 15c-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5z"/></svg>',
            iconSize: [32, 32],
            iconAnchor: [16, 32]
        })
    }).bindPopup(popupContent);
}

// Вспомогательные функции
function showLoading(message) {
    const loadingEl = document.getElementById('loading');
    loadingEl.querySelector('p').textContent = message;
    loadingEl.style.display = 'flex'; // Используем flex для центрирования
}

function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

function showError(message) {
    console.error(message);
    alert(message);
}

//Создаем иконку
function createCircleIcon(color, size = 12) {
    // Создаем canvas элемент
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');

    // Рисуем круг
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Добавляем белую границу (опционально)
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'white';
    ctx.stroke();

    return canvas;
}

//Функция для отображения станции метро
function showMetroStations(city) {
    if (!metroData[city]) return;

    const cityMetro = metroData[city];

    //Создаем слой метро
    const metroLayer = DG.layerGroup();

    //Добавляем каждую ветку
    cityMetro.lines.forEach(line => {
        const stationsCoords = line.stations.map(st => st.coords);
        const polyline = DG.polyline(stationsCoords, {
          color: line.color,
        weight: 6,
        opacity: 0.8
        }).addTo(metroLayer);

        //Станции
        line.stations.forEach(station => {
            const lineColor = line.color;
            DG.marker(station.coords, {
                icon: DG.icon({
                    iconUrl: createCircleIcon(lineColor).toDataURL(),
                    iconSize: [12, 12],
                    iconAnchor: [5, 5]
                })
            })
                .bindPopup(`<b>${station.name}</b><br>Линия: ${line.name}`)
                .addTo(metroLayer);
        });
    });

    //Добавляем слой на карту
    metroLayer.addTo(map);

    //Добавляем в список слоев для управления
    if (!window.metroLayers) window.metroLayers = [];
    window.metroLayers.push(metroLayer);
}

//Управление отображением метро
function initMetroControls() {
    const btn = document.getElementById('toggle-metro');
    let metroVisible = false;

    btn.addEventListener('click', () => {
        metroVisible = !metroVisible;

        if (metroVisible) {
            showMetroStations('Москва');
            btn.textContent = 'Скрыть метро';
        } else {
            hideMetroStations();
            btn.textContent = 'Показать метро'
        }
    });
}

function hideMetroStations() {
    if (window.metroLayers) {
        window.metroLayers.forEach(layer => map.removeLayer(layer));
    }
}

// Глобальные переменные для поиска метро
let metroStationsList = [];

function initMetroSearch() {
    const input = document.getElementById('metro-search-input');
    const suggestions = document.getElementById('metro-suggestions');

     // Мобильный обработчик фокуса
    input.addEventListener('focus', function() {
        if (window.innerWidth <= 768) {
            map.setZoom(13);
            setTimeout(() => {
                suggestions.style.display = 'block';
            }, 300);
        }
    });

    // Собираем все станции метро в один массив
    metroStationsList = metroData.Москва.lines.flatMap(line =>
        line.stations.map(station => ({
            name: station.name,
            coords: station.coords,
            line: line.name,
            lineColor: line.color
        }))
    );

    input.addEventListener('input', function (e) {
        const query = e.target.value.toLowerCase().trim();
        suggestions.innerHTML = '';

        if (query.length < 2) {
            suggestions.style.display = 'none';
            return;
        }

        // Ищем совпадения (регистронезависимо)
        const matches = metroStationsList.filter(station =>
            station.name.toLowerCase().includes(query)
        ).slice(0, 10); // Ограничиваем 10 подсказками

        if (matches.length > 0) {
            matches.forEach(station => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.innerHTML = `
          <span style="color:${station.lineColor}">●</span> 
          ${highlightMatch(station.name, query)}
          <small style="color:#666">${station.line}</small>
        `;
                div.addEventListener('click', () => {
                    selectMetroStation(station);
                    suggestions.style.display = 'none';
                });
                suggestions.appendChild(div);
            });
            suggestions.style.display = 'block';
        } else {
            suggestions.style.display = 'none';
        }
    });

    // Обработка клавиатуры
    input.addEventListener('keydown', function (e) {
        const items = suggestions.querySelectorAll('.suggestion-item');
        let current = suggestions.querySelector('.highlighted');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!current) {
                items[0]?.classList.add('highlighted');
            } else {
                current.classList.remove('highlighted');
                current.nextElementSibling?.classList.add('highlighted');
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (current) {
                current.classList.remove('highlighted');
                current.previousElementSibling?.classList.add('highlighted');
            }
        } else if (e.key === 'Enter' && current) {
            const index = [...items].indexOf(current);
            const station = metroStationsList.find(s =>
                s.name === current.textContent.split('\n')[0].trim()
            );
            if (station) selectMetroStation(station);
        }
    });

    // Скрываем подсказки при клике вне области
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#metro-search')) {
            suggestions.style.display = 'none';
        }
    });
}

function highlightMatch(text, query) {
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index >= 0) {
        return `
      ${text.substring(0, index)}
      <strong>${text.substring(index, index + query.length)}</strong>
      ${text.substring(index + query.length)}
    `;
    }
    return text;
}

function selectMetroStation(station) {
    // Удаляем предыдущий маркер
    if (window.currentMetroMarker) {
        map.removeLayer(window.currentMetroMarker);
    }

    // Создаем новый маркер
    window.currentMetroMarker = DG.marker(station.coords, {
        icon: DG.icon({
            iconUrl: './iconMetro.svg',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        })
    })
        .bindPopup(`
    <div class="metro-popup">
      <h3 style="color:${station.lineColor}">${station.name}</h3>
      <p>Линия: ${station.line}</p>
    </div>
  `)
        .addTo(map);

    // Центрируем карту
    const zoomLevel = window.innerWidth <= 768 ? 15 : 16;
    map.flyTo(station.coords, zoomLevel);

    // Заполняем поле ввода
    document.getElementById('metro-search-input').value = station.name;

    // Открываем popup
    window.currentMetroMarker.openPopup();
}

function handleOrientationChange() {
    if (window.orientation !== undefined) {
        const isPortrait = Math.abs(window.orientation) !== 90;
        map.invalidateSize();
        if (!isPortrait && window.currentMetroMarker) {
            map.setZoom(14);
        }
    }
}
window.addEventListener('orientationchange', handleOrientationChange);

// Запуск при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    if (typeof DG === 'undefined' || typeof ymaps === 'undefined') {
        showError('Не загружены API карт. Обновите страницу.');
        return;
    }
    initApp();
});
