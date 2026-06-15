mod inner;

// absolute paths → external leaves
use std::io::Read;
use std::collections::{HashMap, HashSet};

// external crate
use tokio::runtime::Runtime;
use serde::{Serialize, Deserialize};

// wildcard
use std::fmt::*;

// crate-relative
use crate::inner::InnerType;

pub struct Outer {
    inner: crate::inner::InnerType,
}
