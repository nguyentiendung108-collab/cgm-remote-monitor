'use strict';

function init (ctx) {

  var gmi = {
    name: 'gmi-hba1c'
    , label: 'GMI 14d'
    , pluginType: 'pill-primary'
  };

  var cache = {
    value: null
    , mean: null
    , count: 0
    , updated: 0
    , loading: false
  };

  /*
   * ------------------------------------------------------------
   * Calculate GMI
   *
   * GMI = 3.31 + (0.02392 x mean glucose)
   *
   * Glucose values are mg/dL.
   * ------------------------------------------------------------
   */

  function calculateGMI (entries) {

    if (!Array.isArray(entries) || entries.length === 0) {
      return null;
    }

    var seen = {};

    var values = [];

    entries.forEach(function (entry) {

      if (!entry) {
        return;
      }

      var glucose = Number(entry.sgv);

      var timestamp = Number(entry.date);

      if (!timestamp && entry.dateString) {
        timestamp =
          new Date(entry.dateString).getTime();
      }

      if (
        !isFinite(glucose) ||
        !isFinite(timestamp)
      ) {
        return;
      }

      /*
       * Ignore impossible / invalid CGM values.
       */
      if (glucose < 39) {
        return;
      }

      /*
       * Remove duplicate timestamps.
       */
      var key = String(timestamp);

      if (seen[key]) {
        return;
      }

      seen[key] = true;

      values.push({
        glucose: glucose
        , timestamp: timestamp
      });

    });

    if (values.length === 0) {
      return null;
    }

    /*
     * Sort chronologically.
     */
    values.sort(function (a, b) {

      return a.timestamp - b.timestamp;

    });

    /*
     * ----------------------------------------------------------
     * Fill normal CGM gaps.
     *
     * CGM normally reports approximately every 5 minutes.
     * We only interpolate reasonable gaps.
     *
     * This prevents a missing 5/10/15 minute reading from
     * changing the average disproportionately.
     * ----------------------------------------------------------
     */

    var normalized = [];

    for (var i = 0; i < values.length - 1; i++) {

      var current = values[i];

      var next = values[i + 1];

      normalized.push(current);

      var gap =
        next.timestamp -
        current.timestamp;

      /*
       * Only interpolate gaps between 10 and 25 minutes.
       */
      if (
        gap >= 10 * 60 * 1000 &&
        gap <= 25 * 60 * 1000
      ) {

        var steps =
          Math.round(
            gap / (5 * 60 * 1000)
          );

        if (steps > 1) {

          var glucoseDelta =
            (
              next.glucose -
              current.glucose
            ) / steps;

          for (
            var j = 1;
            j < steps;
            j++
          ) {

            normalized.push({

              glucose:
                current.glucose +
                glucoseDelta * j

              , timestamp:
                current.timestamp +
                (5 * 60 * 1000 * j)

            });

          }

        }

      }

    }

    /*
     * Add final value.
     */
    normalized.push(
      values[values.length - 1]
    );

    /*
     * ----------------------------------------------------------
     * Calculate mean glucose.
     * ----------------------------------------------------------
     */

    var total = 0;

    var count = 0;

    normalized.forEach(function (item) {

      var glucose =
        Number(item.glucose);

      if (
        isFinite(glucose) &&
        glucose >= 39
      ) {

        total += glucose;

        count++;

      }

    });

    if (count === 0) {
      return null;
    }

    var mean =
      total / count;

    /*
     * ----------------------------------------------------------
     * Original GMI equation
     * ----------------------------------------------------------
     */

    var gmiValue =
      3.31 +
      (0.02392 * mean);

    return {

      value:
        gmiValue

      , mean:
        mean

      , count:
        count

    };

  }

  /*
   * ------------------------------------------------------------
   * Load 14 days of CGM data from Nightscout.
   * ------------------------------------------------------------
   */

  function loadGMI (sbx) {

    if (cache.loading) {
      return;
    }

    cache.loading = true;

    var now =
      Date.now();

    var fourteenDays =
      14 * 24 * 60 * 60 * 1000;

    var start =
      now - fourteenDays;

    var url =
      '/api/v1/entries.json' +
      '?find[date][$gte]=' +
      encodeURIComponent(String(start)) +
      '&find[date][$lte]=' +
      encodeURIComponent(String(now)) +
      '&count=10000';

    fetch(url)

      .then(function (response) {

        if (!response.ok) {

          throw new Error(
            'Nightscout API error: ' +
            response.status
          );

        }

        return response.json();

      })

      .then(function (entries) {

        var result =
          calculateGMI(entries);

        if (result) {

          cache.value =
            result.value;

          cache.mean =
            result.mean;

          cache.count =
            result.count;

          cache.updated =
            Date.now();

        }

        cache.loading = false;

        gmi.updateVisualisation(sbx);

      })

      .catch(function (error) {

        console.error(
          'GMI 14d:',
          error
        );

        cache.loading = false;

        gmi.updateVisualisation(sbx);

      });

  }

  /*
   * ------------------------------------------------------------
   * Plugin properties
   * ------------------------------------------------------------
   */

  gmi.setProperties =
    function setProperties (sbx) {

      /*
       * First load.
       */
      if (!cache.updated) {

        loadGMI(sbx);

      }

      /*
       * Refresh every 10 minutes.
       */
      else if (
        Date.now() -
        cache.updated >
        10 * 60 * 1000
      ) {

        loadGMI(sbx);

      }

      sbx.offerProperty(
        'gmi-hba1c',
        function () {

          return cache;

        }
      );

    };

  /*
   * ------------------------------------------------------------
   * Dashboard pill
   * ------------------------------------------------------------
   */

  gmi.updateVisualisation =
    function updateVisualisation (sbx) {

      var prop =
        sbx.properties &&
        sbx.properties['gmi-hba1c'];

      var value =
        '...';

      var info = [];

      if (
        prop &&
        isFinite(prop.value)
      ) {

        value =
          prop.value.toFixed(1) +
          '%';

      }

      if (
        prop &&
        isFinite(prop.mean)
      ) {

        info.push({

          label: 'Average glucose'

          , value:
              prop.mean.toFixed(1) +
              ' mg/dL'

        });

      }

      if (
        prop &&
        prop.count
      ) {

        info.push({

          label: 'Readings'

          , value:
              String(prop.count)

        });

      }

      sbx.pluginBase.updatePillText(

        gmi,

        {

          value: value

          , info:
              info.length
                ? info
                : null

        }

      );

    };

  return gmi;

}

module.exports = init;
