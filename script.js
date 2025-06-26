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

//Функция для отображения станции метро
function showMetroStations(city) {
    if (!metroData[city]) return;

    const cityMetro = metroData[city];

    //Создаем слой метро
    const metroLayer = DG.layerGroup();

    //Добавляем каждую ветку
    cityMetro.lines.forEach(line => {
        //Линия между станциями
        //const stationsCoords = line.stations.map(st => st.coords);
        //const polyline = DG.polyline(stationsCoords, {
          //  color: line.color,
            //weight: 6,
            //opacity: 0.8
        //}).addTo(metroLayer);

        //Станции
        line.stations.forEach(station => {
            DG.marker(station.coords, {
                icon: DG.icon({
                    iconUrl: `<svg version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 512 512" style="enable-background:new 0 0 512 512;" xml:space="preserve"><g><g><path d="M437.02,74.98C388.667,26.629,324.38,0,256,0S123.333,26.629,74.98,74.98C26.628,123.332,0,187.62,0,256 s26.629,132.667,74.98,181.02C123.332,485.372,187.62,512,256,512s132.667-26.629,181.02-74.98 C485.372,388.668,512,324.38,512,256S485.371,123.333,437.02,74.98z M256,482.462C131.129,482.462,29.538,380.871,29.538,256 S131.129,29.538,256,29.538S482.462,131.129,482.462,256S380.871,482.462,256,482.462z"/></g></g><g><g><path d="M405.689,106.311C365.706,66.328,312.545,44.308,256,44.308s-109.706,22.02-149.689,62.003 C66.328,146.294,44.308,199.455,44.308,256s22.02,109.706,62.003,149.689c39.983,39.983,93.144,62.003,149.689,62.003 s109.706-22.02,149.689-62.003c39.983-39.983,62.003-93.144,62.003-149.689S445.672,146.294,405.689,106.311z M256,438.154 C155.56,438.154,73.846,356.44,73.846,256S155.56,73.846,256,73.846c100.441,0,182.154,81.714,182.154,182.154 S356.441,438.154,256,438.154z"/></g></g><g><g><path d="M354.462,162.462h-59.077c-4.223,0-8.243,1.807-11.046,4.965L256,199.358l-28.338-31.93 c-2.803-3.16-6.823-4.966-11.046-4.966h-59.077c-8.157,0-14.769,6.613-14.769,14.769v157.538c0,8.157,6.613,14.769,14.769,14.769 h39.385c8.157,0,14.769-6.613,14.769-14.769v-75.417l33.46,36.209c2.795,3.026,6.728,4.746,10.848,4.746s8.051-1.72,10.848-4.746 l33.46-36.209v75.417c0,8.157,6.613,14.769,14.769,14.769h39.385c8.157,0,14.769-6.613,14.769-14.769V177.231 C369.231,169.074,362.618,162.462,354.462,162.462z M339.692,320h-9.846v-98.393c0-6.08-3.726-11.539-9.387-13.754 c-5.66-2.214-12.102-0.735-16.228,3.731L256,263.776l-48.229-52.193c-4.126-4.465-10.565-5.945-16.228-3.731 c-5.662,2.215-9.387,7.674-9.387,13.754V320h-9.846V192h37.668l34.977,39.411c2.803,3.159,6.823,4.965,11.046,4.965 s8.243-1.807,11.046-4.965L302.024,192h37.668V320z"/></g></g></svg>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
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

// Запуск при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    if (typeof DG === 'undefined' || typeof ymaps === 'undefined') {
        showError('Не загружены API карт. Обновите страницу.');
        return;
    }
    initApp();
});